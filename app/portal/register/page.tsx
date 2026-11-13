import AuthPanel from '../../../components/portal/AuthPanel';
export default async function Page({searchParams}:{searchParams:Promise<{account?:string}>}){const {account}=await searchParams;return <AuthPanel mode="register" initialRole={account==='hauler'?'hauler':'client'}/>;}
