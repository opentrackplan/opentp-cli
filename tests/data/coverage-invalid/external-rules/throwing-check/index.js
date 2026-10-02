// External check used by events/auth/1/false/check_throws.yaml. It throws on purpose: a throwing
// check must produce a validation error for the field, not abort the run.
export default {
  name: "throwing-check",
  validate: () => {
    throw new Error("lookup service unavailable");
  },
};
