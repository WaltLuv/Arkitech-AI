"use client"

/**
 * Client provider layer for theme, sidebar state, user data, and toast rendering.
 */
import { UserDetailContext } from '@/context/UserDetailContext';
import { useUser } from '@clerk/nextjs';
import axios from 'axios';
import React, { useEffect, useState } from 'react'

function Provider({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {

    const { isLoaded, isSignedIn } = useUser();
    const [userDetail, setUserDetail] = useState();
    useEffect(() => {
        if (isLoaded && isSignedIn) {
            createNewUser();
        }
    }, [isLoaded, isSignedIn])

    const createNewUser = async () => {
        const result = await axios.post('/api/users');
        console.log(result);
        setUserDetail(result.data);
    }

    return (
        <div>
            <UserDetailContext.Provider value={{ userDetail, setUserDetail }}>
                {children}
            </UserDetailContext.Provider>
        </div>
    )
}

export default Provider
