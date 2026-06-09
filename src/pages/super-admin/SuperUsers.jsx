import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Shield, Plus, UserCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function SuperAdminUsers() {
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [formData, setFormData] = useState({ email: '', fullName: '' });

  const queryClient = useQueryClient();

  const { data: superUsers, isLoading } = useQuery({
    queryKey: ['super-users'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getSuperUsers', {});
      return res.data.users;
    }
  });

  const addSuperUserMutation = useMutation({
    mutationFn: async (data) => {
      const res = await base44.functions.invoke('addSuperUser', data);
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        setAddUserOpen(false);
        setFormData({ email: '', fullName: '' });
        queryClient.invalidateQueries({ queryKey: ['super-users'] });
      } else {
        toast.error(data.error);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const removeSuperUserMutation = useMutation({
    mutationFn: async (userId) => {
      const res = await base44.functions.invoke('removeSuperUser', { userId });
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        queryClient.invalidateQueries({ queryKey: ['super-users'] });
      } else {
        toast.error(data.error);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    addSuperUserMutation.mutate(formData);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Super Users</h1>
          <p className="text-muted-foreground">Manage super admin access</p>
        </div>
        <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Super User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Super User</DialogTitle>
              <CardDescription>
                Grant super admin access to an existing user
              </CardDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="user@example.com"
                  required
                />
              </div>
              <div>
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  placeholder="John Doe"
                  required
                />
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5" />
                  <p className="text-xs text-yellow-700">
                    This will grant the user full super admin access to manage all companies and platform settings.
                  </p>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={addSuperUserMutation.isPending}>
                {addSuperUserMutation.isPending ? 'Adding...' : 'Grant Super Admin Access'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {superUsers?.map((user) => (
          <Card key={user.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Shield className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">{user.full_name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => removeSuperUserMutation.mutate(user.id)}
                disabled={removeSuperUserMutation.isPending}
              >
                Remove
              </Button>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <UserCheck className="h-4 w-4" />
                <span>Super Admin</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {superUsers?.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Shield className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Super Users</h3>
            <p className="text-sm text-muted-foreground mb-4">Add your first super user to manage the platform</p>
            <Button onClick={() => setAddUserOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Super User
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
