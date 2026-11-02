import type { Metadata } from "next";
import { spendsRealUnits } from "../../../src/mode";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: "Before the camera opens" };

export default function ConsentPage() {
  const instead = spendsRealUnits()
    ? "tests"
    : process.env.MIRA_FIXTURES === "recorded"
      ? "recorded"
      : "sample";
  return <ConsentForm instead={instead} />;
}
