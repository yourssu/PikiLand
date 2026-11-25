/// <reference types="bun" />
import { expect, test } from "bun:test";
import SwaggerParser from "@apidevtools/swagger-parser";
import app from "../src/index";

test("Chanfana generated OpenAPI validates independently and separates engine authentication", async () => {
  const response = await app.request("/api/openapi.json");
  expect(response.status).toBe(200);
  const schema = (await response.json()) as any;
  await SwaggerParser.validate(structuredClone(schema));
  const path = schema.paths["/api/repositories/{repo_id}/incidents"];
  expect(path.get.security).toEqual([{ cookieAuth: [] }]);
  expect(path.post.security).toEqual([{ RepositoryBearer: [] }]);
  expect(path.post.responses[201].content).toBeUndefined();
  expect(path.post.responses[201].headers.Location.required).toBe(true);
  expect(
    path.get.parameters.find((p: any) => p.name === "per_page").schema.maximum,
  ).toBe(30);
  const token = schema.paths["/api/repositories/{repo_id}/tokens/engine"].post;
  expect(token.security).toEqual([{ GitHubActionsOIDC: [] }]);
  expect(
    token.requestBody.content["application/json"].schema.properties.expires_in
      .maximum,
  ).toBe(21900);
  expect(token.responses[201].headers["Cache-Control"]).toBeDefined();
  const detail =
    path.post.requestBody.content["application/json"].schema.properties
      .incident;
  expect(detail.anyOf).toHaveLength(2);
  expect(detail.anyOf[0].properties.pr_generated.enum).toEqual([true]);
  expect(detail.anyOf[1].properties.pr_link.type).toBe("null");
  expect(
    schema.paths["/api/repositories/{repo_id}/incidents/{incident_id}"].delete
      .security,
  ).toEqual([{ cookieAuth: [] }]);
  expect(
    Object.values(schema.paths)
      .flatMap((p: any) => Object.values(p))
      .filter((o: any) =>
        [
          "listIncidents",
          "getIncident",
          "deleteIncident",
          "createIncident",
          "genenginetoken",
        ].includes(o.operationId),
      ),
  ).toHaveLength(5);
});
