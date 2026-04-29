import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { type Static, Type } from "@sinclair/typebox";

/**
 * Schema for the sendMedia tool parameters.
 */
const sendMediaSchema = Type.Object({
  url: Type.String({
    description:
      "URL or path of the media to send. Accepts http/https URLs, local file paths (/...), file:// URIs, or mxc:// URIs. Can be an image, video, or audio file.",
  }),
  caption: Type.Optional(
    Type.String({
      description: "Caption text shown below the media in Matrix. Defaults to 'media'.",
    }),
  ),
});

export type SendMediaInput = Static<typeof sendMediaSchema>;

/**
 * Create a sendMedia tool that the LLM can call to send images/video/audio to Matrix.
 *
 * @param sendMediaFn Callback that performs the actual send (bridges to ReplySink)
 *   Returns a success message string or throws on error.
 */
export function createSendMediaTool(
  sendMediaFn: (url: string, caption?: string) => Promise<string>,
): ToolDefinition<typeof sendMediaSchema> {
  return defineTool({
    name: "sendMedia",
    label: "Send Media",
    description:
      "Send an image, video, or audio file to the user via Matrix. " +
      "Use this when you want to share a visual reference, screenshot, chart, or any media file. " +
      "Accepts: http/https URLs (public), local file paths (/...), file:// URIs, or mxc:// URIs. " +
      "Supported formats: images (jpg, png, gif, webp, svg), video (mp4, webm), audio (mp3, wav, ogg). " +
      "Maximum file size: 10 MB.",
    parameters: sendMediaSchema,
    promptGuidelines: [
      "Use sendMedia when the user asks for a screenshot, chart, diagram, or any visual reference.",
      "Use sendMedia when you find a relevant image URL while researching.",
      "Always include a descriptive caption explaining what the media shows.",
      "Do NOT use sendMedia for text content — use regular text responses instead.",
    ],
    async execute(_toolCallId, { url, caption }: SendMediaInput, _signal, _onUpdate, _ctx) {
      try {
        const result = await sendMediaFn(url, caption);
        return {
          content: [{ type: "text", text: result }],
          details: undefined,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to send media: ${message}` }],
          details: undefined,
        };
      }
    },
  });
}
