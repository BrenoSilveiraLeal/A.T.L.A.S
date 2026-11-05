/** Transparent lettering painted directly over the reception wall. */
export function drawOfficePlaque(g: CanvasRenderingContext2D, office: { name: string; fullName?: string; tagline?: string }) {
  const width = 2048, height = 720, centerX = width / 2, textWidth = width - 240;
  const family = '"Manrope Variable", sans-serif';
  g.clearRect(0, 0, width, height);
  g.shadowBlur = 0;

  g.textAlign = "center"; g.textBaseline = "alphabetic";
  const fit = (text: string, weight: number, size: number, min: number) => {
    g.font = `${weight} ${size}px ${family}`;
    while (size > min && g.measureText(text).width > textWidth) g.font = `${weight} ${--size}px ${family}`;
  };
  fit(office.name, 800, 236, 128);
  g.fillStyle = "#fffaf4"; g.fillText(office.name, centerX, 258);
  fit(office.fullName ?? "", 600, 50, 32);
  g.fillStyle = "#fff0df"; g.fillText(office.fullName ?? "", centerX, 334);

  g.strokeStyle = "#f5b47f"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(320, 382); g.lineTo(width - 320, 382); g.stroke();

  const words = (office.tagline ?? "").split(/\s+/).filter(Boolean);
  g.font = `600 64px ${family}`;
  let lines = [words.join(" ")], difference = Infinity;
  for (let at = 1; at < words.length; at++) {
    const pair = [words.slice(0, at).join(" "), words.slice(at).join(" ")];
    const sizes = pair.map((line) => g.measureText(line).width);
    const score = Math.abs(sizes[0] - sizes[1]);
    if (Math.max(...sizes) <= textWidth && score < difference) { lines = pair; difference = score; }
  }
  g.fillStyle = "#fffaf4";
  lines.forEach((line, at) => {
    fit(line, 600, 64, 40);
    g.fillText(line, centerX, lines.length === 1 ? 548 : 504 + at * 82);
  });
}
