// A check plugin that prints to stdout when it is imported (inside validation, while `opentp mcp` is
// serving). The output must go to stderr, not into the MCP protocol on stdout.
console.log("noisy-check: console.log at import");
process.stdout.write("noisy-check: process.stdout.write at import\n");

export default {
  name: "noisy-check",
  validate: () => {
    console.info("noisy-check: console.info in validate");
    return { valid: true };
  },
};
