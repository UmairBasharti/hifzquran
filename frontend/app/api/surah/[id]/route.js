import { NextResponse } from "next/server";

export async function GET(request, { params }) {
  // Next 16 makes dynamic route params a Promise — must be awaited (see bundled next docs).
  const { id } = await params;

  // Read backend URL from env, fallback to localhost for dev
  const backendUrl = process.env.PYTHON_BACKEND_URL || 
                     process.env.NEXT_PUBLIC_PYTHON_BACKEND_URL || 
                     "http://127.0.0.1:8000";

  try {
    const res = await fetch(`${backendUrl}/surah/${id}`, {
      // Use next.js caching if desired, but we want fresh data for now
      cache: "no-store", 
    });

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ error: "Surah not found" }, { status: 404 });
      }
      if (res.status === 503) {
        return NextResponse.json({ error: "Backend still loading data" }, { status: 503 });
      }
      throw new Error(`Backend returned ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
    
  } catch (error) {
    console.error(`Error fetching surah ${id} from backend:`, error);
    return NextResponse.json(
      { error: "Failed to connect to HifzAI backend" },
      { status: 500 }
    );
  }
}
