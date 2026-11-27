import { ACTIONS_CORS_HEADERS } from "@/lib/solanaActions";

export async function GET() {
  return Response.json(
    {
      rules: [
        {
          pathPattern: "/api/actions/**",
          apiPath: "/api/actions/**",
        },
        {
          pathPattern: "/*",
          apiPath: "/api/actions/tip/*",
        },
      ],
    },
    { headers: ACTIONS_CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: ACTIONS_CORS_HEADERS });
}
