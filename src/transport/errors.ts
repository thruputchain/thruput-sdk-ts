import { ThruputError } from "../errors/thruputError.js";

/** A JSON-RPC error object. Keep the raw object, including additive fields. */
export function rpcError(
  code: number,
  rpcMessage: string,
  data?: unknown,
  method?: string,
  raw?: unknown,
): ThruputError<"rpcError"> {
  return new ThruputError(
    "rpcError",
    `${method ? `${method}: ` : ""}${rpcMessage} (RPC ${code})`,
    {
      context: {
        code,
        rpcMessage,
        ...(data === undefined ? {} : { data }),
        ...(method === undefined ? {} : { method }),
        raw: raw ?? {
          code,
          message: rpcMessage,
          ...(data === undefined ? {} : { data }),
        },
      },
    },
  );
}

/** An HTTP status that is not successful. */
export function httpResponseError(
  status: number,
  statusText: string,
  endpoint?: string,
  method?: string,
): ThruputError<"httpResponseError"> {
  return new ThruputError(
    "httpResponseError",
    `HTTP ${status}: ${statusText}${method ? ` (${method} at ${endpoint})` : ""}`,
    {
      context: {
        status,
        statusText,
        ...(endpoint === undefined ? {} : { endpoint }),
        ...(method === undefined ? {} : { method }),
      },
    },
  );
}

/** A network failure, with the endpoint origin only. */
export function httpRequestFailed(
  endpoint: string,
  method: string,
  cause: unknown,
): ThruputError<"httpRequestFailed"> {
  return new ThruputError(
    "httpRequestFailed",
    `${method}: request to ${endpoint} failed`,
    { context: { endpoint, method }, cause },
  );
}

/** A malformed JSON-RPC reply after dispatch. The write outcome is unknown. */
export function rpcResponseInvalid(
  message: string,
  raw: unknown,
  cause?: unknown,
): ThruputError<"rpcResponseInvalid"> {
  return new ThruputError("rpcResponseInvalid", message, {
    context: { raw },
    ...(cause === undefined ? {} : { cause }),
  });
}
