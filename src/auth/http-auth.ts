import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OidcFacade } from "./oidc.js";

declare module "fastify" {
  interface FastifyRequest {
    authInfo?: AuthInfo;
  }
}

export const verifyBearerToken = (oidc: OidcFacade) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authorization = request.headers.authorization;
    if (!authorization) {
      reply.header(
        "www-authenticate",
        `Bearer resource_metadata="${new URL(".well-known/oauth-protected-resource/mcp", new URL(request.url, "http://localhost")).pathname}"`,
      );
      throw reply.code(401).send({
        error: "invalid_token",
        error_description: "Missing Authorization header",
      });
    }

    const [scheme, token] = authorization.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      throw reply.code(401).send({
        error: "invalid_token",
        error_description: "Expected Bearer token",
      });
    }

    const authInfo = await oidc.verifyAccessToken(token);
    request.authInfo = authInfo;
    (request.raw as FastifyRequest["raw"] & { auth?: AuthInfo }).auth = authInfo;
  };
};
