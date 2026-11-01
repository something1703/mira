import { listen } from "@mira/runtime";
import { buildApp } from "./app";

await listen(buildApp());
