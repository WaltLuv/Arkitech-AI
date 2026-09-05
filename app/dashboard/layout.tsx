/**
 * Dashboard shell that wraps protected pages with navigation and shared sidebar state.
 */
import { AppSidebar } from '@/components/custom/dashboard/AppSidebar'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import React from 'react'

function Dashboardlayout({ children }: { children: React.ReactNode }) {
    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarTrigger />
            <div className='min-w-0 flex-1 overflow-x-hidden'>{children}</div>
        </SidebarProvider>
    )
}

export default Dashboardlayout
