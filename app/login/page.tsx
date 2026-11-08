import type { Metadata } from "next"
import Image from "next/image"

import { LoginForm } from "@/components/login-form"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Log in · Synra",
}

export default function LoginPage() {
  return (
    <div className="flex min-h-svh items-center justify-center px-4 py-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Synra logo"
            width={36}
            height={36}
            loading="eager"
            className="size-9"
          />
          <span className="font-heading text-xl font-semibold tracking-tight">
            Synra
          </span>
        </div>
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-lg">Log in</CardTitle>
            <CardDescription>
              Enter your email and password to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
