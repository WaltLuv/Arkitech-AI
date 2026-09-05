"use client"

/**
 * Dashboard sidebar navigation with account, route, and sign-out controls.
 */
import { Progress } from "@/components/ui/progress"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenuButton,
} from "@/components/ui/sidebar"
import { UserDetailContext } from "@/context/UserDetailContext"
import { UserButton } from "@clerk/nextjs"
import { AppWindow, Blocks, Bot, Layers, Play, Settings, User2 } from "lucide-react"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { useContext, useState } from "react"

export function AppSidebar() {

    const path = usePathname();
    const { userDetail, setUserDetail } = useContext(UserDetailContext);
    const router = useRouter();
    return (
        <Sidebar>
            <SidebarHeader className="flex flex-row gap-2.5 items-center px-4 py-4" >
                <Image src={"/logo.svg"} alt="logo" width={40} height={40} />
                <h2 className="font-semibold text-lg text-slate-900 ">Arkitech AI</h2>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup className="flex gap-1">
                    <SidebarGroupLabel>Workspace</SidebarGroupLabel>
                    <SidebarMenuButton onClick={() => router.push('/dashboard')} className={`h-12 gap-3 hover:bg-slate-100 ${path == ('/dashboard') ? 'bg-slate-100' : null}`}>
                        <div className=" flex h-9 w-9 shrink-0 bg-blue-100 items-center justify-center rounded-lg">
                            <AppWindow className="h-[18px] w-[18px] text-blue-900" />
                        </div>
                        <span>Dashboard</span>
                    </SidebarMenuButton>
                    <SidebarMenuButton onClick={() => router.push('/dashboard/agents')} className={`h-12 gap-3 hover:bg-slate-100 ${path == ('/dashboard/agents') ? 'bg-slate-100' : null}`}>
                        <div className=" flex h-9 w-9 shrink-0 bg-green-100 items-center justify-center rounded-lg">
                            <Bot className="h-[18px] w-[18px] text-green-900" />
                        </div>
                        <span>Agents</span>
                    </SidebarMenuButton>
                    <SidebarMenuButton onClick={() => router.push('/dashboard/run')} className={`h-12 gap-3 hover:bg-slate-100 ${path == ('/dashboard/run') ? 'bg-slate-100' : null}`}>
                        <div className=" flex h-9 w-9 shrink-0 bg-red-100 items-center justify-center rounded-lg">
                            <Play className="h-[18px] w-[18px] text-red-900" />
                        </div>
                        <span>Runs</span>
                    </SidebarMenuButton>
                    <SidebarMenuButton onClick={() => router.push('/dashboard/integrations')} className={`h-12 gap-3 hover:bg-slate-100 ${path == ('/dashboard/integrations') ? 'bg-slate-100' : null}`}>
                        <div className=" flex h-9 w-9 shrink-0 bg-purple-100 items-center justify-center rounded-lg">
                            <Blocks className="h-[18px] w-[18px] text-purple-900" />
                        </div>
                        <span>Integrations</span>
                    </SidebarMenuButton>
                    <SidebarMenuButton onClick={() => router.push('/dashboard/templates')} className={`h-12 gap-3 hover:bg-slate-100 ${path == ('/dashboard/templates') ? 'bg-slate-100' : null}`}>
                        <div className=" flex h-9 w-9 shrink-0 bg-orange-100 items-center justify-center rounded-lg">
                            <Layers className="h-[18px] w-[18px] text-orange-900" />
                        </div>
                        <span>Templates</span>
                    </SidebarMenuButton>

                </SidebarGroup>
                <SidebarGroup >
                    <SidebarGroupLabel>Users</SidebarGroupLabel>
                    <SidebarMenuButton onClick={() => router.push('/dashboard/settings')} className={`h-12 gap-3 hover:bg-slate-100 ${path == ('/dashboard/settings') ? 'bg-slate-100' : null}`}>
                        <div className=" flex h-9 w-9 shrink-0 bg-gray-100 items-center justify-center rounded-lg">
                            <Settings className="h-[18px] w-[18px] text-gray-900" />
                        </div>
                        <span>Settings</span>
                    </SidebarMenuButton>
                    <SidebarMenuButton onClick={() => router.push('/dashboard/profile')} className={`h-12 gap-3 hover:bg-slate-100 ${path == ('/dashboard/profile') ? 'bg-slate-100' : null}`}>
                        <div className=" flex h-9 w-9 shrink-0 bg-yellow-100 items-center justify-center rounded-lg">
                            <User2 className="h-[18px] w-[18px] text-yellow-900" />
                        </div>
                        <span>Profile</span>
                    </SidebarMenuButton>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter >
                <div className="p-2 border rounded-lg flex gap-2 flex-col">
                    <h2 className="flex justify-between">Agents <span>{userDetail?.agentCredits}/5</span></h2>
                    <h2 className="flex justify-between">Credits <span>{userDetail?.usageCredits}</span></h2>
                    <Progress value={66} />
                </div>
                <div className="flex items-center p-2 mt-2 gap-2.5">
                    <UserButton />
                    <span>{userDetail?.name}</span>
                </div>
            </SidebarFooter>
        </Sidebar>
    )
}
