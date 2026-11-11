/** Native acceptance and durable projection are different facts. Claim both
 * before callbacks run: ACK, echo and recovery must join the same barrier. */
export function createInputReceipt<Acceptance>(project: (receipt: Acceptance) => Promise<void>) {
  let acceptance: Acceptance | undefined;
  let projection: Promise<void> | undefined;
  let retired = false;
  return {
    get accepted() { return projection !== undefined; },
    get acceptance() { return acceptance; },
    get projection() { return projection; },
    retire() { retired = true; },
    accept(receipt: Acceptance): Promise<void> {
      if (!projection) {
        if (retired) return Promise.reject(new Error("Input owner is closed; delivery is unknown"));
        acceptance = receipt;
        projection = Promise.resolve().then(() => project(receipt));
      }
      return projection;
    },
  };
}
