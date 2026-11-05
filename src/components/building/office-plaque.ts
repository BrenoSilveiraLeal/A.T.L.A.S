/** Artwork for the physical reception sign; text stays sharp when the camera approaches it. */
export function drawOfficePlaque(g: CanvasRenderingContext2D, office: { name: string; fullName?: string; tagline?: string }) {
  const width = 2048, height = 720, textX = 440, textWidth = 1480;
  const family = '"Manrope Variable", sans-serif';
  g.clearRect(0, 0, width, height);
  g.fillStyle = "#111a2c";
  g.fillRect(0, 0, width, height);
  g.shadowBlur = 0;

  // A restrained monogram balances the wordmark without competing with either description.
  g.fillStyle = "#a3cdb5";
  g.beginPath(); g.roundRect(104, 138, 266, 266, 34); g.fill();
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "#16291e"; g.font = `800 208px ${family}`;
  g.fillText(office.name.charAt(0), 237, 281);

  g.textAlign = "left"; g.textBaseline = "alphabetic";
  const fit = (text: string, weight: number, size: number, min: number) => {
    g.font = `${weight} ${size}px ${family}`;
    while (size > min && g.measureText(text).width > textWidth) g.font = `${weight} ${--size}px ${family}`;
  };
  fit(office.name, 800, 240, 128);
  g.fillStyle = "#eef3fb"; g.fillText(office.name, textX, 275);
  fit(office.fullName ?? "", 500, 50, 32);
  g.fillStyle = "#a9b6cc"; g.fillText(office.fullName ?? "", textX, 355);

  g.strokeStyle = "#39465a"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(textX, 414); g.lineTo(width - 128, 414); g.stroke();

  const words = (office.tagline ?? "").split(/\s+/).filter(Boolean);
  g.font = `600 68px ${family}`;
  let lines = [words.join(" ")], difference = Infinity;
  for (let at = 1; at < words.length; at++) {
    const pair = [words.slice(0, at).join(" "), words.slice(at).join(" ")];
    const sizes = pair.map((line) => g.measureText(line).width);
    const score = Math.abs(sizes[0] - sizes[1]);
    if (Math.max(...sizes) <= textWidth && score < difference) { lines = pair; difference = score; }
  }
  g.fillStyle = "#eef3fb";
  lines.forEach((line, at) => {
    fit(line, 600, 68, 40);
    g.fillText(line, textX, lines.length === 1 ? 558 : 518 + at * 86);
  });
}
