"use client"

/**
 * Client provider layer for theme, sidebar state, user data, and toast rendering.
 */
import { UserDetail, UserDetailContext } from '@/context/UserDetailContext';
import { useUser } from '@clerk/nextjs';
import axios from 'axios';
import React, { useEffect, useState } from 'react'

function Provider({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {

    const { isLoaded, isSignedIn } = useUser();
    const [userDetail, setUserDetail] =
        useState<UserDetail | UserDetail[] | undefined>();
    useEffect(() => {
        if (!isLoaded || !isSignedIn) return
        let cancelled = false
        axios.post('/api/users').then((result) => {
            if (!cancelled) setUserDetail(result.data)
        })
        return () => { cancelled = true }
    }, [isLoaded, isSignedIn])


    return (
        <div>
            <UserDetailContext.Provider value={{ userDetail, setUserDetail }}>
                {children}
            </UserDetailContext.Provider>
        </div>
    )
}

export default Provider
