import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  request.nextUrl.searchParams.delete("path");
  return NextResponse.json(
    { message: "Manual preview now requires the authenticated document file endpoint." },
    { status: 410 },
  );
}
