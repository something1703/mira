// Written from the OpenAPI bundles downloaded 2026-11-01 (docs v1.17; see openapi/SOURCES.md).
import { z } from "zod";

/**
 * Response envelopes, written by hand from the saved bundles (D11). The bundles mis-nest `results`
 * and `data`, so these follow the Integration Guide prose and the worked examples instead.
 */

export const RegisterFileResponse = z.object({
  status: z.number().optional(),
  data: z.object({
    files: z
      .array(
        z.object({
          file_id: z.string().min(1),
          requests: z
            .array(
              z.object({
                method: z.string(),
                url: z.url(),
                headers: z.record(z.string(), z.string()).default({}),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
  }),
});

export const CreateTaskResponse = z.object({
  status: z.number().optional(),
  data: z.object({ task_id: z.string().min(1) }),
});

export const TaskStatusResponse = z.object({
  status: z.number().optional(),
  data: z.object({
    task_status: z.enum(["running", "success", "error"]),
    error: z.string().nullish(),
    error_message: z.string().nullish(),
    results: z.unknown().optional(),
  }),
});

export const OkResponse = z.object({ status: z.number().optional() }).loose();

export const CreditResponse = z.object({
  status: z.number().optional(),
  results: z.array(
    z.object({
      // IDs can exceed 2^53; the HTTP layer turns them into strings before parsing.
      id: z.union([z.string(), z.number()]).optional(),
      type: z.string().optional(),
      amount_dec: z.number(),
      /** Milliseconds since the epoch. */
      expiry: z.number().optional(),
    }),
  ),
});

export const FeatureCostResponse = z.object({
  status: z.number().optional(),
  result: z.object({
    next_token: z.string().nullish(),
    skus: z.array(
      z.object({
        description: z.string().optional(),
        amount: z.number(),
        unit: z.enum(["result_image", "second"]).optional(),
        proc_unit: z.number().optional(),
        run_task_url: z.string(),
      }),
    ),
  }),
});
