"use client";
import { OFFICES, officeOnFloor, STATUS_LABEL, TENANTS, TOWER } from "@/core/building";

/**
 * The tower drawn flat, in section (phones, or when 3D is not available): every floor is a row and
 * the three office floors are clickable.
 */
export function Elevator2D({ selected, onSelect, onEnter }: { selected: number | null; onSelect: (floor: number) => void; onEnter: (floor: number) => void }) {
  const row = 26, top = 40, width = 320, x = 60, w = 200;
  const y = (floor: number) => top + (TOWER.floors - floor) * row;
  const height = y(0) + row * 1.6 + 20;
  return (
    <svg className="elevator2d" viewBox={`0 0 ${width + 60} ${height}`} role="group" aria-label="Prédio ATLAS em corte">
      <rect x={x - 6} y={top - 18} width={w + 12} height={18} rx={3} className="e2d-roof" />
      <text x={x + w / 2} y={top - 5} textAnchor="middle" className="e2d-brand">ATLAS</text>
      {Array.from({ length: TOWER.floors }, (_, i) => TOWER.floors - i).map((floor) => {
        const office = officeOnFloor(floor), active = selected === floor;
        if (!office) return (
          <g key={floor} aria-hidden="true">
            <rect x={x} y={y(floor)} width={w} height={row - 3} className="e2d-floor" />
            <text x={x - 10} y={y(floor) + row / 2 + 2} textAnchor="end" className="e2d-number">{floor}</text>
            <text x={x + 10} y={y(floor) + row / 2 + 2} className="e2d-tenant">{TENANTS[floor] ?? ""}</text>
          </g>
        );
        return (
          <g key={floor} className={`e2d-office status-${office.status.toLowerCase()} ${active ? "selected" : ""}`} role="button" tabIndex={0}
            aria-pressed={active} aria-label={`Andar ${floor}: ${office.name}, ${STATUS_LABEL[office.status]}`} style={{ "--office": office.color } as React.CSSProperties}
            onClick={() => onSelect(floor)} onDoubleClick={() => onEnter(floor)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (active) onEnter(floor); else onSelect(floor); } }}>
            <rect x={x} y={y(floor)} width={w} height={row - 3} rx={2} />
            <text x={x - 10} y={y(floor) + row / 2 + 2} textAnchor="end" className="e2d-number">{floor}</text>
            <text x={x + 10} y={y(floor) + row / 2 + 2} className="e2d-name">{office.name}</text>
            <text x={x + w - 8} y={y(floor) + row / 2 + 2} textAnchor="end" className="e2d-status">{STATUS_LABEL[office.status]}</text>
          </g>
        );
      })}
      <rect x={x} y={y(0)} width={w} height={row * 1.6} className="e2d-lobby" />
      <text x={x + w / 2} y={y(0) + row} textAnchor="middle" className="e2d-tenant">Térreo · recepção</text>
      <line x1={0} x2={width + 60} y1={y(0) + row * 1.6} y2={y(0) + row * 1.6} className="e2d-street" />
      <text x={width + 50} y={height - 6} textAnchor="end" className="e2d-hint">{OFFICES.length} escritórios ATLAS</text>
    </svg>
  );
}
