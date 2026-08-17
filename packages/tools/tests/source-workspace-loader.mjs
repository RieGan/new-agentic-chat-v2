export const resolve = async (specifier, context, nextResolve) => {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (
      error instanceof Error &&
      error.code === "ERR_MODULE_NOT_FOUND" &&
      specifier.endsWith(".js") &&
      context.parentURL?.includes("/packages/contracts/src/")
    ) {
      return nextResolve(
        new URL(specifier.replace(/\.js$/u, ".ts"), context.parentURL).href,
        context,
      )
    }
    throw error
  }
}
