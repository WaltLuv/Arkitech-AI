"use client"

/**
 * Profile page that displays the authenticated user details and current credits.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { UserDetailContext } from "@/context/UserDetailContext"
import { useUser } from "@clerk/nextjs"
import { CalendarDays, Mail, User2 } from "lucide-react"
import moment from "moment"
import React, { useContext } from "react"

function ProfilePage() {
    const { user } = useUser()
    const { userDetail } = useContext(UserDetailContext)
    const currentUser = Array.isArray(userDetail) ? userDetail[0] : userDetail
    const displayName = currentUser?.name || user?.fullName || "Arkitech user"
    const email = currentUser?.email || user?.primaryEmailAddress?.emailAddress || "No email found"
    const initials = displayName
        .split(" ")
        .map((part: string) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()

    return (
        <div className="mx-auto w-full max-w-4xl px-6 py-10">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
                <p className="mt-1 text-sm text-muted-foreground">Manage your account identity and demo workspace details.</p>
            </div>

            <section className="mt-6 rounded-2xl border bg-background p-5 shadow-sm">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                        <Avatar className="size-16 border">
                            <AvatarImage src={user?.imageUrl} alt={displayName} />
                            <AvatarFallback>{initials}</AvatarFallback>
                        </Avatar>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-xl font-semibold">{displayName}</h2>
                                <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">Demo</Badge>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">{email}</p>
                        </div>
                    </div>
                    <Badge variant="outline" className="w-fit">Managed by Clerk</Badge>
                </div>
            </section>

            <section className="mt-6 grid gap-4 md:grid-cols-3">
                <ProfileInfo icon={<User2 className="size-4" />} label="Account" value={displayName} />
                <ProfileInfo icon={<Mail className="size-4" />} label="Email" value={email} />
                <ProfileInfo icon={<CalendarDays className="size-4" />} label="Joined" value={currentUser?.createdAt ? moment(currentUser.createdAt).format("MMM D, YYYY") : "Recently"} />
            </section>
        </div>
    )
}

function ProfileInfo({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
    return (
        <div className="rounded-xl border bg-background p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                {icon}
                {label}
            </div>
            <p className="mt-3 truncate font-semibold">{value}</p>
        </div>
    )
}

export default ProfilePage
