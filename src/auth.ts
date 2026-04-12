import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    /** セッションにemailを含める（従業員マスタとの照合用） */
    async session({ session }) {
      return session;
    },
    /** Google Workspaceドメイン制限（設定時のみ） */
    async signIn({ profile }) {
      const allowedDomain = process.env.GOOGLE_ALLOWED_DOMAIN;
      if (allowedDomain && profile?.email) {
        return profile.email.endsWith(`@${allowedDomain}`);
      }
      return true;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
});
