import type { Metadata } from "next";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: "Before the camera opens" };

export default function ConsentPage() {
  return <ConsentForm recorded={process.env.MIRA_FIXTURES === "recorded"} />;
}
