import './portal.css';
export const metadata={title:'Lope Portal | Lope Trucking Services',robots:{index:false,follow:false}};
export default function PortalLayout({children}:{children:React.ReactNode}){return <div className="portal-root">{children}</div>}
