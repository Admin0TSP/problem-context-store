import { redirect } from 'next/navigation';

/**
 * Root route — middleware handles the auth fork (signed-in → /dashboard,
 * else → /signin). This page only renders if middleware is bypassed for
 * some reason; we redirect to /dashboard as a safe default.
 */
export default function RootPage() {
  redirect('/dashboard');
}
