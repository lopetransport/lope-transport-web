import { handleEnquiry } from '../../lib/enquiry-handler';
export async function POST(request: Request) { return handleEnquiry(request, 'dispatch'); }
