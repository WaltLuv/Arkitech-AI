/**
 * Shown for an unmatched route, and for anything that calls notFound().
 *
 * Deliberately says nothing about why: whether a run id is wrong, belongs to
 * someone else, or never existed is not a distinction worth handing to
 * someone guessing ids.
 */
import Link from "next/link";

export default function NotFound() {
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
                    Page not found
                </h1>
                <p style={{ color: "#666", margin: "0 0 1.5rem", lineHeight: 1.5 }}>
                    This page does not exist, or you do not have access to it.
                </p>
                <Link href="/dashboard" style={{ color: "#2457D6" }}>
                    Back to the dashboard
                </Link>
            </div>
        </div>
    );
}
