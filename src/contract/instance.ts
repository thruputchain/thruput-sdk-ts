import type { ContractAddress } from "@groundhogchain/protocol";
import type { GroundhogClient } from "../client.js";
import type { ContractMethod, ContractViewOptions } from "./method.js";

/** A method descriptor with address/client defaults bound for reads and calls. */
export type BoundContractMethod<A, R, E> = Omit<
  ContractMethod<A, R, E>,
  "view" | "viewOutcome" | "viewRequest" | "call"
> & {
  viewRequest(
    options: Omit<
      Parameters<ContractMethod<A, R, E>["viewRequest"]>[0],
      "contract"
    >,
  ): ReturnType<ContractMethod<A, R, E>["viewRequest"]>;
  view(
    options: Omit<ContractViewOptions<A>, "client" | "contract">,
  ): ReturnType<ContractMethod<A, R, E>["view"]>;
  viewOutcome(
    options: Omit<ContractViewOptions<A>, "client" | "contract">,
  ): ReturnType<ContractMethod<A, R, E>["viewOutcome"]>;
  call(
    options: Omit<Parameters<ContractMethod<A, R, E>["call"]>[0], "contract">,
  ): ReturnType<ContractMethod<A, R, E>["call"]>;
};

/** Bound methods inferred from a generated interface object. */
export type ContractInstance<T> = {
  [K in keyof T]: T[K] extends ContractMethod<infer A, infer R, infer E>
    ? BoundContractMethod<A, R, E>
    : never;
};

/**
 * Bind a generated interface to an address and public client.
 * Views preserve heights and events and accept cancellation and minimum-height
 * constraints. A minimum height is a freshness floor; use readViews when several
 * results must come from the same snapshot.
 *
 * @example
 * ```ts
 * const token = getContract({ binding: ERC20.v0_1, address, client });
 * const balance = await token.getBalanceOf.view({ args: { addr: owner }, signal });
 * ```
 */
export function getContract<
  // The binding contains different argument types; ContractInstance preserves each one.
  T extends Record<string, ContractMethod<any, unknown, unknown>>,
>(options: {
  binding: T;
  address: ContractAddress;
  client: Pick<GroundhogClient, "view">;
}): ContractInstance<T> {
  const address = options.address.slice() as ContractAddress;
  return Object.fromEntries(
    Object.entries(options.binding).map(([key, method]) => [
      key,
      {
        ...method,
        viewRequest: (input: Parameters<typeof method.viewRequest>[0]) =>
          method.viewRequest({ ...input, contract: address }),
        view: (input: ContractViewOptions<never>) =>
          method.view({ ...input, contract: address, client: options.client }),
        viewOutcome: (input: ContractViewOptions<never>) =>
          method.viewOutcome({
            ...input,
            contract: address,
            client: options.client,
          }),
        call: (input: Parameters<typeof method.call>[0]) =>
          method.call({ ...input, contract: address }),
      },
    ]),
  ) as unknown as ContractInstance<T>;
}
