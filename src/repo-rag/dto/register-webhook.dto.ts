import { IsUrl } from 'class-validator';

export class RegisterWebhookDto {
  /**
   * Full public URL GitHub will POST to (e.g. ngrok tunnel + /api/v1/github/webhook).
   */
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_tld: false,
    },
    { message: 'url must be a valid http(s) URL' },
  )
  url!: string;
}
