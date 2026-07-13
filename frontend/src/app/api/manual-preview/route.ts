import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/config/api-base-url";

const SAFE_PREVIEW_PATH = /^\/uploads\/[A-Za-z0-9._-]+\.pdf$/i;

export async function GET(request: NextRequest) {
  const previewPath = request.nextUrl.searchParams.get("path") ?? "";

  if (!SAFE_PREVIEW_PATH.test(previewPath)) {
    return NextResponse.json({ message: "Invalid manual preview path" }, { status: 400 });
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}${previewPath}`, {
      cache: "no-store",
    });

    if (!response.ok || !response.body) {
      return NextResponse.json(
        { message: "Manual preview is unavailable" },
        { status: response.status || 502 },
      );
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ message: "Unable to load manual preview" }, { status: 502 });
  }
}
