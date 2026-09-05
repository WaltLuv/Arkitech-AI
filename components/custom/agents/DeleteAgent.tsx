/**
 * Confirmation dialog that deletes an agent and its scheduled run records.
 */
import React, { useState } from 'react'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import axios from 'axios'
import { toast } from '@/components/ui/toast'
import { Loader2Icon } from 'lucide-react'

type props = {
    openAlert: boolean,
    agentId: string | undefined,
    closeAlert: () => void,
    refreshData: () => void
}

function DeleteAgent({ openAlert, agentId, closeAlert, refreshData }: props) {

    const [loading, setLoading] = useState(false);

    const deleteAgent = async () => {
        setLoading(true);
        const result = await axios.delete('/api/agent/configure', {
            data: { agentId: agentId }
        });

        if (result?.data?.error) {
            toast.add({
                type: 'error',
                title: result?.data?.error
            })
            return;
        }

        setLoading(false);
        closeAlert();
        refreshData()

    }

    return (
        <AlertDialog open={openAlert} onOpenChange={closeAlert}>

            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete your Agent
                        from our servers.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => closeAlert()}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteAgent()} disabled={loading}>
                        {loading && <Loader2Icon className='animate-spin' />}
                        Continue</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export default DeleteAgent