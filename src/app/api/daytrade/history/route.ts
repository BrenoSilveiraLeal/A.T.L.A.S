import { z } from "zod";
import rawConfig from "../../../../../config/daytrade.json";
import { B3_CALENDAR } from "@/core/b3-calendar";
import { dashConfigSchema } from "@/core/daytrade/config";
import { dayTradeSession } from "@/core/daytrade/session";
import { checkProfitDllGateway, failure, json, readBody } from "@/lib/http";
import { required } from "@/lib/env";
import { adminClient } from "@/lib/supabase";
import { ApiError } from "@/lib/auth";

export const runtime = "nodejs";

const historySchema = z.object({
  instrument: z.string().regex(/^[A-Z0-9$]{3,12}$/),
  sessionDay: z.string().date(),
  tradeCount: z.number().int().min(1).max(2_000_000),
  bars: z.array(z.object({
    bucketAt: z.string().datetime({ offset: true }),
    open: z.number().finite().positive(), high: z.number().finite().positive(),
    low: z.number().finite().positive(), close: z.number().finite().positive(),
    volume: z.number().int().positive().refine(Number.isSafeInteger), turnover: z.number().finite().positive(),
  }).strict()).min(1).max(1440),
}).strict();

/** Import a completed, read-only ProfitDLL historical session; live quote ingest stays separate. */
export async function GET(request: Request) {
  try {
    checkProfitDllGateway(request);
    const config = dashConfigSchema.parse(rawConfig);
    const instrument = config.instruments.find((item) => item.enabled && item.verified && item.symbol);
    if (!instrument?.symbol)
      throw new ApiError(422, "INSTRUMENT_NOT_READY", "DASH sem contrato habilitado e verificado para o gateway.");
    const ownerId = required("ATLAS_OWNER_ID");
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
    const oldest = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oldestDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(oldest);
    const { data, error } = await adminClient().from("dt_market_history_sessions").select("session_day")
      .eq("owner_id", ownerId).eq("instrument", instrument.symbol)
      .gte("session_day", oldestDay).lt("session_day", today)
      .order("session_day", { ascending: true }).limit(30);
    if (error) throw new ApiError(503, "DASH_HISTORY_STORE_UNAVAILABLE", "Armazenamento de histórico do DASH indisponível.");
    return json({ status: "READY", provider: "PROFITDLL_HISTORY", instrument: instrument.symbol,
      readOnly: true, completedSessions: (data ?? []).map((row) => row.session_day) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkProfitDllGateway(request);
    const ownerId = required("ATLAS_OWNER_ID");
    const body = historySchema.parse(await readBody(request, 256 * 1024));
    const config = dashConfigSchema.parse(rawConfig);
    const instrument = config.instruments.find((item) => item.enabled && item.verified && item.symbol === body.instrument);
    if (!instrument?.symbol || instrument.tickSize === null)
      throw new ApiError(422, "INSTRUMENT_NOT_READY", "Contrato não está habilitado e verificado na configuração do DASH.");

    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
    const oldest = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oldestDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(oldest);
    if (body.sessionDay >= today || body.sessionDay < oldestDay || (instrument.expiresOn && body.sessionDay > instrument.expiresOn))
      throw new ApiError(422, "HISTORY_RANGE_INVALID", "Importe apenas pregões completos do contrato dentro da retenção histórica da ProfitDLL.");

    const sessionAt = new Date(`${body.sessionDay}T12:00:00-03:00`);
    const session = dayTradeSession(sessionAt, config, instrument.expiresOn ?? null);
    const calendar = B3_CALENDAR[Number(body.sessionDay.slice(0, 4))];
    if (session.state !== "OPEN" || calendar?.lateOpen[body.sessionDay])
      throw new ApiError(422, "SESSION_NOT_REGULAR", "A data não é um pregão regular com abertura das 09:00 no calendário B3 verificado.");

    let previousBucket = -Infinity;
    let totalVolume = 0;
    const bars = body.bars.map((bar, index) => {
      const bucket = Date.parse(bar.bucketAt);
      const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(bucket));
      const localTime = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(bucket));
      if (!Number.isFinite(bucket) || bucket % 60_000 !== 0 || localDay !== body.sessionDay || localTime < session.open || localTime >= session.close)
        throw new ApiError(422, "HISTORY_BAR_TIME_INVALID", `Candle ${index} fora do pregão regular informado.`);
      if (bucket <= previousBucket)
        throw new ApiError(422, "HISTORY_BAR_ORDER_INVALID", "Candles históricos devem estar em ordem cronológica e sem duplicatas.");
      previousBucket = bucket;
      if (bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high))
        throw new ApiError(422, "HISTORY_BAR_OHLC_INVALID", `OHLC inválido no candle ${index}.`);
      if ([bar.open, bar.high, bar.low, bar.close].some((price) => Math.abs(price / instrument.tickSize! - Math.round(price / instrument.tickSize!)) > 1e-8))
        throw new ApiError(422, "HISTORY_BAR_TICK_INVALID", `Preço fora do tick no candle ${index}.`);
      const tolerance = Math.max(0.01, bar.high * bar.volume * 1e-9);
      if (bar.turnover < bar.low * bar.volume - tolerance || bar.turnover > bar.high * bar.volume + tolerance)
        throw new ApiError(422, "HISTORY_BAR_TURNOVER_INVALID", `Turnover inconsistente no candle ${index}.`);
      totalVolume += bar.volume;
      if (!Number.isSafeInteger(totalVolume))
        throw new ApiError(422, "HISTORY_TOTALS_INVALID", "Volume agregado excede a precisão inteira segura do servidor.");
      return { bucket_at: bar.bucketAt, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, turnover: bar.turnover };
    });
    // Trade-derived history can legitimately have minutes with no executions and therefore
    // no M1 candle. Preserve those gaps; do not synthesize OHLC or confuse zero-trade minutes
    // with dropped source data. The gateway posts only after ProfitDLL progress reaches 100.
    if (totalVolume < body.tradeCount)
      throw new ApiError(422, "HISTORY_TOTALS_INVALID", "Volume agregado menor que o número de negócios recebido.");

    const { data, error } = await adminClient().rpc("dt_import_market_history", {
      p_owner_id: ownerId,
      p_instrument: instrument.symbol,
      p_session_day: body.sessionDay,
      p_trade_count: body.tradeCount,
      p_bars: bars,
    });
    if (error) throw new ApiError(500, "DASH_HISTORY_WRITE_FAILED", "Falha ao validar e persistir o histórico ProfitDLL.");
    return json(data);
  } catch (error) {
    return failure(error);
  }
}
