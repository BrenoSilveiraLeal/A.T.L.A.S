import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DASH · Day Trade",
  icons: {
    icon: [{ url: "/dash-icon.svg?v=20261102", type: "image/svg+xml" }],
  },
};

export default function DaytradeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
