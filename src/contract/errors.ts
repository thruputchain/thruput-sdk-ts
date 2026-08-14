/** Error raised when contract bytes do not match their declared ABI type. */
export class ContractDecodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ContractDecodeError";
  }
}
