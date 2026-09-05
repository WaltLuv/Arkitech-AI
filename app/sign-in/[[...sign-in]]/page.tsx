/**
 * Clerk sign-in page mounted inside the Next.js app router.
 */
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: '#09090b' }}>
      <SignIn />
    </main>
  );
}
