import type { ContractAddress } from "@groundhogchain/protocol";
import type { GroundhogClient } from "../client.js";
import type { ContractMethod, ContractViewOptions } from "./method.js";

/** A method descriptor with address/client defaults bound for reads and calls. */
export type BoundContractMethod<A, R, E> = Omit<
  ContractMethod<A, R, E>,
  "view" | "viewOutcome" | "call"
> & {
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

/** Bind a generated interface to an address and public client; preserve view heights and events. */
export function getContract<
  T extends Record<string, ContractMethod<never, unknown, unknown>>,
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
