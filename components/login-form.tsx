"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// UI only: no auth is wired up yet, so submitting does nothing. Preventing the
// default submit keeps the browser from putting the password in the URL.
export function LoginForm() {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <Button type="submit" className="w-full">
        Log in
      </Button>
    </form>
  )
}
