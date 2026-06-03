export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-8">
      <div className="animate-pulse flex flex-col items-center gap-6 w-full max-w-2xl">
        <div className="h-8 bg-gray-200 rounded-md w-1/3 mb-4"></div>
        
        {/* Mushaf-style line placeholders */}
        <div className="h-12 bg-gray-100 rounded-md w-full"></div>
        <div className="h-12 bg-gray-100 rounded-md w-11/12"></div>
        <div className="h-12 bg-gray-100 rounded-md w-full"></div>
        <div className="h-12 bg-gray-100 rounded-md w-4/5"></div>
        <div className="h-12 bg-gray-100 rounded-md w-full"></div>
        
        <div className="h-6 bg-gray-200 rounded-md w-1/4 mt-4"></div>
      </div>
    </div>
  );
}
