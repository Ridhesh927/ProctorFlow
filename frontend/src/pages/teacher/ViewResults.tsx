import { BarChart3 } from 'lucide-react';
import DashboardLayout from '../../layouts/DashboardLayout';

const ViewResults = () => {
    return (
        <DashboardLayout userType="teacher">
            <div className="results-page" style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center', 
                minHeight: '70vh', 
                textAlign: 'center',
                padding: '2rem'
            }}>
                <div className="neo-card" style={{ 
                    padding: '4rem 2rem', 
                    maxWidth: '500px', 
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center'
                }}>
                    <BarChart3 size={48} className="text-accent" style={{ marginBottom: '1.5rem', opacity: 0.8 }} />
                    <h2 style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>Coming Soon</h2>
                    <p className="text-muted" style={{ lineHeight: '1.6', fontSize: '1.1rem' }}>
                        We are currently working on the advanced data analysis and script viewing dashboard. 
                        This feature will be back soon!
                    </p>
                </div>
            </div>
        </DashboardLayout>
    );
};

export default ViewResults;

