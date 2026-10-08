import { NextRequest, NextResponse } from "next/server";

const LISTMONK_HOST = process.env.LISTMONK_HOST;
const LIST_UUID = process.env.LISTMONK_LIST_UUID;

/** Validates and returns ListMonk configuration from environment variables.
 *
 * @returns Object with `host` and `listUuid` properties
 * @throws Error if LISTMONK_HOST or LISTMONK_LIST_UUID env vars are unset
 */
function getListmonkConfig(): { host: string; listUuid: string } {
  if (!LISTMONK_HOST) {
    throw new Error("LISTMONK_HOST environment variable is not set");
  }
  if (!LIST_UUID) {
    throw new Error("LISTMONK_LIST_UUID environment variable is not set");
  }
  return { host: LISTMONK_HOST, listUuid: LIST_UUID };
}

/** Handle newsletter subscription POST requests.
 *
 * Validates the request body for a valid email, checks honeypot field,
 * and forwards the subscription to the ListMonk API. Handles 409 (already
 * subscribed), validation errors, and configuration errors gracefully.
 *
 * @param request - Incoming Next.js request object
 * @returns JSON response with success status or error message
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const bodyObj = JSON.parse(rawBody);

    if (typeof bodyObj !== "object" || bodyObj === null || Array.isArray(bodyObj)) {
      return NextResponse.json(
        { message: "Request body must be a JSON object." },
        { status: 400 }
      );
    }

    if (bodyObj.website) {
      return NextResponse.json(
        { message: "Something went wrong. Please try again." },
        { status: 400 }
      );
    }

    const { email, name } = bodyObj;

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { message: "Please provide a valid email address." },
        { status: 422 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { message: "Please provide a valid email address." },
        { status: 422 }
      );
    }

    const { host, listUuid } = getListmonkConfig();

    const response = await fetch(`${host}/api/public/subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        name: name && typeof name === "string" ? name : email.split("@")[0],
        list_uuids: [listUuid],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("ListMonk API error:", errorData);

      if (response.status === 409) {
        return NextResponse.json(
          { success: true, alreadySubscribed: true, message: "You're already on the list!" },
          { status: 200 }
        );
      }

      return NextResponse.json(
        { message: "Failed to subscribe. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("LISTMONK_")) {
      console.error("ListMonk configuration error:", error.message);
      return NextResponse.json(
        { message: "Server configuration error. Please contact support." },
        { status: 500 }
      );
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { message: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    console.error("Subscription error:", error);
    return NextResponse.json(
      { message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
