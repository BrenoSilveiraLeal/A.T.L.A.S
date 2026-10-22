import { describe, expect, it } from "vitest";
import { parseBcbNewsAtom } from "@/providers/bcb-news";
import { enabledMarketFeeds, MARKET_FEEDS, parseRss } from "@/providers/rss";

const now = Date.parse("2026-10-22T22:00:00Z");

describe("free news feeds for the office TV", () => {
  it("reads Banco Central Atom entries from its own site only", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="text">Copom mant&#233;m a Selic</title>
      <updated>2026-10-22T18:00:00-03:00</updated><link rel="alternate" href="https://www.bcb.gov.br/detalhenoticia/1/noticia" /></entry>
      <entry><title>Fora</title><updated>2026-10-22T18:00:00-03:00</updated><link href="https://example.com/x" /></entry></feed>`;
    expect(parseBcbNewsAtom(xml, now)).toEqual([{ title: "Copom mantém a Selic", url: "https://www.bcb.gov.br/detalhenoticia/1/noticia",
      domain: "bcb.gov.br", language: "Portuguese", seenAt: "2026-10-22T21:00:00.000Z" }]);
    expect(() => parseBcbNewsAtom("<html></html>", now)).toThrow();
  });

  it("reads market RSS titles and links and refuses future dates", () => {
    const item = (date: string) => `<rss><channel><item><title><![CDATA[Petrobras (PETR4) sobe]]></title>
      <link>https://www.infomoney.com.br/mercados/petr4/</link><pubDate>${date}</pubDate></item></channel></rss>`;
    expect(parseRss(MARKET_FEEDS.infomoney, item("Thu, 22 Oct 2026 21:02:41 +0000"), now)[0])
      .toMatchObject({ title: "Petrobras (PETR4) sobe", domain: "infomoney.com.br" });
    expect(() => parseRss(MARKET_FEEDS.infomoney, item("Fri, 23 Oct 2026 21:02:41 +0000"), now)).toThrow();
    expect(parseRss(MARKET_FEEDS.moneytimes, item("Thu, 22 Oct 2026 21:02:41 +0000"), now)).toEqual([]);
  });

  it("keeps Money Times off unless the owner enables it", () => {
    expect(enabledMarketFeeds({}).map((f) => f.provider)).toEqual(["infomoney"]);
    expect(enabledMarketFeeds({ ATLAS_NEWS_MONEYTIMES: "true" }).map((f) => f.provider)).toEqual(["infomoney", "moneytimes"]);
  });
});
