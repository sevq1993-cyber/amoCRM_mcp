declare module "oidc-provider" {
  export class Provider {
    constructor(issuer: string, configuration: Record<string, unknown>);
    callback(): (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void;
    interactionDetails(req: unknown, res: unknown): Promise<any>;
    interactionFinished(req: unknown, res: unknown, result: unknown, options?: { mergeWithLastSubmission?: boolean }): Promise<void>;
    pathFor(name: string, options?: Record<string, unknown>): string;
    Client: { find: (clientId: string) => Promise<any> };
    Grant: new (options: Record<string, unknown>) => any;
    AccessToken: { find: (token: string) => Promise<any> };
    ClientCredentials: { find: (token: string) => Promise<any> };
    RefreshToken: { find: (token: string) => Promise<any> };
  }
}
