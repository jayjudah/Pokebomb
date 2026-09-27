// Optional "AI scan" engine: sends one still frame of the card to Claude and
// asks for the name and collector number. Much sturdier than OCR on holo and
// full-art cards. The API key stays on this device (localStorage) and the
// request goes straight from the browser to Anthropic.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const CardRead = z.object({
  is_pokemon_card: z.boolean().describe("False if there is no Pokémon TCG card in the image."),
  name: z.string().describe("Card name exactly as printed, including suffixes like ex, V, VSTAR."),
  collector_number: z.string().describe("Number before the slash at the bottom, e.g. '130' from '130/167'. Empty if unreadable."),
  set_total: z.number().int().describe("Number after the slash, e.g. 167. 0 if unreadable."),
});

export type CardRead = z.infer<typeof CardRead>;

let client: Anthropic | null = null;
let clientKey = "";

export async function readCardWithClaude(apiKey: string, jpegBase64: string): Promise<CardRead | null> {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    clientKey = apiKey;
  }
  const response = await client.beta.messages.parse({
    model: "claude-opus-5",
    max_tokens: 1024,
    output_config: { effort: "low", format: betaZodOutputFormat(CardRead) },
    // If a safety classifier declines, let the API retry on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
          {
            type: "text",
            text: "Identify this Pokémon trading card. Read the name from the top and the collector number from the bottom left corner.",
          },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") return null;
  const read = response.parsed_output;
  return read && read.is_pokemon_card ? read : null;
}
