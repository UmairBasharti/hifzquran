import { NextResponse } from "next/server";

export async function POST(request) {
  // Read backend URL from env, fallback to localhost for dev
  const backendUrl = process.env.PYTHON_BACKEND_URL || 
                     process.env.NEXT_PUBLIC_PYTHON_BACKEND_URL || 
                     "http://127.0.0.1:8000";

  try {
    const body = await request.json();

    const res = await fetch(`${backendUrl}/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Backend returned ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data, { status: 201 });
    
  } catch (error) {
    console.error("Error saving session to backend:", error);
    return NextResponse.json(
      { error: "Failed to save session" },
      { status: 500 }
    );
  }
}
