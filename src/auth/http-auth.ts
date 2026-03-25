import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createBearerChallenge, extractBearerToken } from "./oidc.js";
import type { OidcFacade } from "./oidc.js";

declare module "fastify" {
  interface FastifyRequest {
    authInfo?: AuthInfo;
  }
}

export const verifyBearerToken = (oidc: OidcFacade, resourceMetadataUrl: string) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      reply.header("www-authenticate", createBearerChallenge(resourceMetadataUrl));
      return reply.code(401).send({
        error: "invalid_token",
        error_description: "Missing or invalid Authorization header",
      });
    }

    const authInfo = await oidc.verifyAccessToken(token);
    request.authInfo = authInfo;
    (request.raw as FastifyRequest["raw"] & { auth?: AuthInfo }).auth = authInfo;
  };
};
