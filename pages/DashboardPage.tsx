
import React, { useEffect, useState, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
// import { Button } from '../components/ui/Button'; // Não usado diretamente aqui
import { Sale, Product, Customer, PaymentStatus, SaleProductItem } from '../types';
import { salesService } from '../services/salesService';
import { productService } from '../services/productService';
import { customerService } from '../services/customerService';
import { dashboardService, DashboardData } from '../services/dashboardService';
import { 
    PresentationChartLineIcon, 
    ShoppingCartIcon, 
    UserGroupIcon, 
    CurrencyDollarIcon,
} from '../constants.tsx'; 
import { useAuth } from '../contexts/AuthContext';

const formatCurrency = (valueInCents: number, showSymbol = true): string => {
    const value = (valueInCents / 100).toFixed(2).replace('.', ',');
    return showSymbol ? `R$ ${value}` : value;
};

const getStatusClass = (status: PaymentStatus) => {
  switch (status) {
    case PaymentStatus.PAID: return 'bg-status-success/20 text-status-success';
    case PaymentStatus.WAITING_PAYMENT: return 'bg-status-warning/20 text-status-warning';
    case PaymentStatus.CANCELLED:
    case PaymentStatus.EXPIRED:
    case PaymentStatus.FAILED:
      return 'bg-status-error/20 text-status-error';
    default: return 'bg-neutral-700 text-text-muted';
  }
};

export const DashboardPage: React.FC = () => {
  const [allSales, setAllSales] = useState<Sale[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [recentActivity, setRecentActivity] = useState<Sale[]>([]);

  const [dateRangeFilter, setDateRangeFilter] = useState('today');
  const [productFilter, setProductFilter] = useState('all');
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { accessToken, isLoading: authLoading } = useAuth();

  const dateRangeOptions = [
    { label: 'Hoje', value: 'today' },
    { label: 'Ontem', value: 'yesterday' },
    { label: 'Últimos 7 dias', value: 'last7days' },
    { label: 'Últimos 30 dias', value: 'last30days' },
    { label: 'Este Mês', value: 'thisMonth' },
    { label: 'Mês Anterior', value: 'lastMonth' },
    { label: 'Todo o período', value: 'all' },
  ];

  const fetchInitialData = useCallback(async () => {
    if (authLoading) return;
    
    setIsLoading(true);
    setError(null);
    try {
      const [salesRes, productsRes, customersRes] = await Promise.all([
        salesService.getSales(accessToken), 
        productService.getProducts(accessToken), 
        customerService.getCustomers(accessToken) 
      ]);
      setAllSales(salesRes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setAllProducts(productsRes);
      setAllCustomers(customersRes);
    } catch (err: any) {
      setError(err.message || 'Falha ao carregar dados do dashboard.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [authLoading, accessToken]); 

  useEffect(() => {
    if (!authLoading) { 
        fetchInitialData();
    }
  }, [fetchInitialData, authLoading]);

  useEffect(() => {
    if (!isLoading && allSales.length >= 0) { 
      try {
        const data = dashboardService.getDashboardData({
          sales: allSales, customers: allCustomers, products: allProducts,
          dateRange: dateRangeFilter, productId: productFilter,
        });
        setDashboardData(data);
        
        const sortedSalesForActivity = [...allSales]
          .filter(s => s.status === PaymentStatus.PAID || s.status === PaymentStatus.WAITING_PAYMENT)
          .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setRecentActivity(sortedSalesForActivity.slice(0, 5));

      } catch (processingError: any) {
        console.error("Error processing dashboard data:", processingError);
        setError("Erro ao processar dados para o dashboard.");
        setDashboardData(null);
      }
    } else if (!isLoading && allSales.length === 0) {
        setDashboardData({
            totalRevenue: 0, numberOfSales: 0, averageTicket: 0, newCustomers: 0, salesTrend: []
        });
        setRecentActivity([]);
    }
  }, [allSales, allProducts, allCustomers, dateRangeFilter, productFilter, isLoading]);

  const getMainChartTitle = () => {
    const selectedOption = dateRangeOptions.find(opt => opt.value === dateRangeFilter);
    return `Tendência de Vendas (${selectedOption ? selectedOption.label.toLowerCase() : dateRangeFilter})`;
  };
  
  const getMainChartSubTitle = () => {
    if (!dashboardData || !dashboardData.salesTrend || dashboardData.salesTrend.length === 0) return "Nenhum dado para o período selecionado.";
    if (dateRangeFilter === 'today') return `Hoje, ${dashboardData.salesTrend[0].periodLabel} - ${dashboardData.salesTrend[dashboardData.salesTrend.length - 1].periodLabel}`;
    
    const firstPeriod = dashboardData.salesTrend[0].periodLabel;
    const lastPeriod = dashboardData.salesTrend[dashboardData.salesTrend.length - 1].periodLabel;
    
    if (dateRangeFilter === "thisMonth" || dateRangeFilter === "lastMonth") {
        const monthName = new Date(2000, parseInt(firstPeriod.split('/')[1]) -1, 1).toLocaleString('pt-BR', { month: 'long' });
        return `${monthName.charAt(0).toUpperCase() + monthName.slice(1)}`;
    }
    if (dateRangeFilter === "all") return "Todo o período";
    return `${firstPeriod} - ${lastPeriod}`;
  };

  if (authLoading || (isLoading && !dashboardData)) { 
    return (
      <div className="flex flex-col justify-center items-center h-[calc(100vh-200px)] text-center">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-xl text-text-muted">Carregando dados do dashboard...</p>
        <p className="text-sm text-text-muted/70">Isso pode levar alguns segundos.</p>
      </div>
    );
  }
  
  if (error) {
    return <div className="text-center text-status-error p-6 bg-status-error/10 rounded-2xl shadow-lg border border-status-error/30">{error}</div>;
  }

  const maxSalesTrendValue = dashboardData?.salesTrend.reduce((max, item) => Math.max(max, item.amount), 0) || 1;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <h1 className="text-4xl font-bold text-text-strong">Visão Geral</h1>
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <select 
            value={dateRangeFilter} 
            onChange={(e) => setDateRangeFilter(e.target.value)}
            className="p-3 border border-border-subtle rounded-xl shadow-sm focus:ring-2 focus:ring-accent-blue-neon focus:border-accent-blue-neon text-sm w-full sm:w-auto bg-white/5 text-text-default backdrop-blur-sm"
          >
            {dateRangeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <select 
            value={productFilter} 
            onChange={(e) => setProductFilter(e.target.value)}
            className="p-3 border border-border-subtle rounded-xl shadow-sm focus:ring-2 focus:ring-accent-blue-neon focus:border-accent-blue-neon text-sm w-full sm:w-auto bg-white/5 text-text-default backdrop-blur-sm"
          >
            <option value="all">Todos os produtos</option>
            {allProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {dashboardData ? (
            <>
                <StatCard title="Receita Total" value={formatCurrency(dashboardData.totalRevenue)} icon={CurrencyDollarIcon} />
                <StatCard title="Vendas Pagas" value={dashboardData.numberOfSales} icon={ShoppingCartIcon} />
                <StatCard title="Ticket Médio" value={formatCurrency(dashboardData.averageTicket)} icon={PresentationChartLineIcon} />
                <StatCard title="Novos Clientes" value={dashboardData.newCustomers} icon={UserGroupIcon} />
            </>
        ) : (
            Array.from({ length: 4 }).map((_, index) => (
                <Card key={index}>
                    <div className="animate-pulse flex space-x-4 p-4">
                        <div className="rounded-full bg-neutral-700/50 h-12 w-12"></div>
                        <div className="flex-1 space-y-3 py-1">
                            <div className="h-4 bg-neutral-700/50 rounded w-3/4"></div>
                            <div className="h-5 bg-neutral-700/50 rounded w-1/2"></div>
                        </div>
                    </div>
                </Card>
            ))
        )}
      </div>

      <Card className="col-span-1 md:col-span-2 lg:col-span-4">
        <div className="p-1 sm:p-2"> {/* Reduced padding for chart card content */}
          <div className="flex flex-col sm:flex-row justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-semibold text-accent-gold">{getMainChartTitle()}</h3>
              <p className="text-sm text-text-muted">{getMainChartSubTitle()}</p>
            </div>
            <div className="text-right mt-2 sm:mt-0">
              <p className="text-sm text-text-muted">Total no período</p>
              <p className="text-3xl font-bold text-accent-blue-neon">
                {dashboardData ? formatCurrency(dashboardData.salesTrend.reduce((acc, curr) => acc + curr.amount, 0)) : formatCurrency(0)}
              </p>
            </div>
          </div>
          <div className="h-80 bg-transparent rounded-lg flex items-end justify-around p-4 border-t border-border-subtle overflow-x-auto space-x-2">
             {dashboardData && dashboardData.salesTrend.length > 0 ? (
                dashboardData.salesTrend.map((item, index) => (
                  <div key={index} className="flex flex-col items-center flex-grow min-w-[30px] sm:min-w-[40px] group relative">
                    <div 
                      className="w-full bg-accent-blue-neon hover:opacity-80 transition-all duration-200 rounded-t-md shadow-lg"
                      style={{ height: `${(item.amount / maxSalesTrendValue) * 100}%` }}
                      title={`${item.periodLabel}: ${formatCurrency(item.amount)}`}
                    >
                       <span className="sr-only">{`${item.periodLabel}: ${formatCurrency(item.amount)}`}</span>
                    </div>
                    <span className="mt-2 text-xs text-text-muted group-hover:text-text-default truncate">{item.periodLabel}</span>
                  </div>
                ))
             ) : (
                <p className="text-text-muted text-center w-full self-center py-10">Nenhuma tendência de vendas para exibir.</p>
             )}
          </div>
        </div>
      </Card>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card title="Atividade Recente">
          {recentActivity.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {recentActivity.map(sale => (
                <li key={sale.id} className="py-4">
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 sm:gap-4">
                    <div className='flex-grow'>
                      <p className="text-sm font-medium text-text-strong truncate max-w-xs sm:max-w-sm">
                        {Array.isArray(sale.products) ? sale.products.map((p: SaleProductItem) => p.name).join(', ') : 'Produtos Indisponíveis'}
                      </p>
                      <p className="text-xs text-text-muted">Para: {sale.customer.email}</p>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
                        <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusClass(sale.status)}`}>
                        {sale.status === PaymentStatus.PAID ? 'PAGO' : sale.status === PaymentStatus.WAITING_PAYMENT ? 'AG. PAG.' : sale.status.replace(/_/g,' ')}
                        </span>
                        <span className="text-sm font-semibold text-accent-blue-neon">{formatCurrency(sale.totalAmountInCents)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-muted text-sm p-4 text-center">Nenhuma atividade recente de vendas.</p>
          )}
        </Card>

        <Card title="Produtos Mais Vendidos (Top 3)">
          <div className="text-text-muted text-sm p-4 text-center">
            { dashboardData && dashboardData.salesTrend.length > 0 ? 
                "Funcionalidade de produtos mais vendidos será implementada em breve." : 
                "Sem dados de vendas para mostrar produtos mais vendidos."}
          </div>
        </Card>
      </div>
    </div>
  );
};

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon: Icon }) => {
  return (
    <Card> {/* Card já tem glassmorphism */}
      <div className="flex items-center">
        <div className="p-3.5 bg-accent-blue-neon/10 rounded-full mr-4 border border-accent-blue-neon/30">
          <Icon className="h-7 w-7 text-accent-blue-neon" />
        </div>
        <div>
          <p className="text-sm text-text-muted">{title}</p>
          <p className="text-2xl sm:text-3xl font-bold text-text-strong">{value}</p>
        </div>
      </div>
    </Card>
  );
};
