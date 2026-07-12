type Result<T> = [T, null] | [null, Error];

export async function tryCatch<T extends Promise<unknown>>(
  promise: T,
): Promise<Result<Awaited<T>>> {
  try {
    const result = await promise;
    return [result, null] as Result<Awaited<T>>;
  } catch (error) {
    return [null, error instanceof Error ? error : new Error(String(error))];
  }
}
