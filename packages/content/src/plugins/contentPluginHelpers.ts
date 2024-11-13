import type { z } from "zod";

export class ContentPluginError extends Error {
  constructor(pluginName: string, message: string, cause?: Error) {
    const newMessage = `Error in content plugin "${pluginName}": ${message}`;
    super(newMessage, { cause });
    this.name = "ContentPluginError";
  }
}

export function parsePluginConfig<T extends z.ZodTypeAny>(pluginName: string, schema: T, input: unknown) {
  try {
    return schema.parse(input);
  } catch (err) {
    throw new ContentPluginError(pluginName, "unable to parse config", err as Error);
  }
}