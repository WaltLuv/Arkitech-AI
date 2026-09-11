"use client";

/**
 * The last resort: an error thrown by the root layout itself, which happens
 * before app/error.tsx exists to catch anything.
 *
 * Because it replaces the root layout, it has to render its own <html> and
 * <body>, and it cannot rely on providers, fonts, or global CSS: whichever of
 * those threw is the reason this is on screen. Everything here is inline for
 * that reason.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html lang="en">
            <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
                <div
                    style={{
                        minHeight: "100vh",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "2rem",
                        textAlign: "center",
                    }}
                >
                    <div style={{ maxWidth: "28rem" }}>
                        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
                            Arkitech could not start
                        </h1>
                        <p style={{ color: "#666", margin: "0 0 1.5rem", lineHeight: 1.5 }}>
                            Something failed before the page could load. This is on our
                            side.
                        </p>

                        <button
                            onClick={reset}
                            style={{
                                padding: "0.5rem 1rem",
                                borderRadius: "6px",
                                border: "1px solid #ddd",
                                background: "#fff",
                                cursor: "pointer",
                                font: "inherit",
                            }}
                        >
                            Try again
                        </button>

                        {error.digest ? (
                            <p style={{ color: "#999", fontSize: "0.75rem", marginTop: "1.5rem" }}>
                                Reference: {error.digest}
                            </p>
                        ) : null}
                    </div>
                </div>
            </body>
        </html>
    );
}
