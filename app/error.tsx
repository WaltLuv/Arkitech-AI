"use client";

/**
 * Catches a render error anywhere below the root layout.
 *
 * Without this file Next serves its built-in page, which in production is an
 * unstyled blank screen with no way back. What it must not do is show the
 * error: a server-side message reaches this component in production as a
 * generic string, but the digest and any client-thrown message do not, and a
 * stack trace on screen is the kind of thing that names a table or a route.
 * The digest is shown because it is the only way a user can tell support
 * which failure they hit, and it is an opaque hash on its own.
 */
import { useEffect } from "react";

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Reaches the host's log collector, where the detail belongs.
        console.error(error);
    }, [error]);

    return (
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
                    Something went wrong
                </h1>
                <p style={{ color: "#666", margin: "0 0 1.5rem", lineHeight: 1.5 }}>
                    The page could not be displayed. Trying again often works; if it
                    does not, the problem is on our side rather than yours.
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
    );
}
